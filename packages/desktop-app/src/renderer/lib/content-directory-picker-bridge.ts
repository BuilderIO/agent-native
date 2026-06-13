export function buildContentDirectoryPickerBridgeScript(): string {
  return String.raw`(() => {
  var PATCH_KEY = "__agentNativeContentDirectoryPickerPatched";
  if (window[PATCH_KEY]) return true;

  var bridge =
    window.agentNativeDesktop && window.agentNativeDesktop.contentFiles;
  if (!bridge || typeof bridge.chooseFolder !== "function") return false;

  function makeError(message, name) {
    try {
      return new DOMException(message, name);
    } catch {
      var err = new Error(message);
      err.name = name;
      return err;
    }
  }

  function safeName(name) {
    var value = String(name || "");
    if (
      !value ||
      value === "." ||
      value === ".." ||
      value.indexOf("/") !== -1 ||
      value.indexOf("\\") !== -1 ||
      value.indexOf("\0") !== -1
    ) {
      throw makeError("Invalid file name.", "TypeMismatchError");
    }
    return value;
  }

  function pathFor(prefix, name) {
    return String(prefix || "") + safeName(name);
  }

  function folderRequest(folderId) {
    return folderId ? { folderId: folderId } : undefined;
  }

  function actionError(result, fallback) {
    return makeError(
      (result && result.error) || fallback || "Folder access failed.",
      result && result.canceled ? "AbortError" : "InvalidStateError",
    );
  }

  async function readSources(folderId) {
    var result = await bridge.readFiles(folderRequest(folderId));
    if (!result || !result.ok) throw actionError(result, "Read failed.");
    return {
      folder: result.folder || {},
      sources: result.sources || {},
    };
  }

  async function dataToText(data) {
    if (typeof data === "string") return data;
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return await data.text();
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(data);
    }
    if (data == null) return "";
    return String(data);
  }

  function DesktopWritable(folderId, filePath) {
    this._folderId = folderId;
    this._path = filePath;
    this._parts = [];
  }

  DesktopWritable.prototype.write = async function (data) {
    if (data && typeof data === "object" && typeof data.type === "string") {
      if (data.type === "truncate") {
        this._parts = [];
        return;
      }
      if (data.type === "seek") return;
      if (data.type === "write") {
        this._parts.push(await dataToText(data.data));
        return;
      }
    }
    this._parts.push(await dataToText(data));
  };

  DesktopWritable.prototype.close = async function () {
    var result = await bridge.writeFile({
      folderId: this._folderId,
      path: this._path,
      content: this._parts.join(""),
    });
    if (!result || !result.ok) throw actionError(result, "Write failed.");
  };

  DesktopWritable.prototype.abort = async function () {
    this._parts = [];
  };

  function DesktopFileHandle(name, filePath, folderId) {
    this.kind = "file";
    this.name = name;
    this._path = filePath;
    this._folderId = folderId;
  }

  DesktopFileHandle.prototype.getFile = async function () {
    var read = await readSources(this._folderId);
    if (!Object.prototype.hasOwnProperty.call(read.sources, this._path)) {
      throw makeError("File not found.", "NotFoundError");
    }
    var lastModified = Date.parse(read.folder.updatedAt || "");
    return new File([read.sources[this._path]], this.name, {
      type: /\.mdx$/i.test(this.name) ? "text/mdx" : "text/markdown",
      lastModified: Number.isFinite(lastModified) ? lastModified : Date.now(),
    });
  };

  DesktopFileHandle.prototype.createWritable = async function () {
    return new DesktopWritable(this._folderId, this._path);
  };

  DesktopFileHandle.prototype.isSameEntry = async function (other) {
    return Boolean(
      other &&
        other.kind === "file" &&
        other._folderId === this._folderId &&
        other._path === this._path,
    );
  };

  function DesktopDirectoryHandle(name, prefix, folderId) {
    this.kind = "directory";
    this.name = name;
    this._prefix = prefix || "";
    this._folderId = folderId;
  }

  DesktopDirectoryHandle.prototype.values = async function* () {
    var read = await readSources(this._folderId);
    var children = new Map();
    var prefix = this._prefix;
    Object.keys(read.sources)
      .sort()
      .forEach(function (filePath) {
        if (prefix && !filePath.startsWith(prefix)) return;
        var rest = prefix ? filePath.slice(prefix.length) : filePath;
        if (!rest) return;
        var slash = rest.indexOf("/");
        if (slash === -1) {
          if (!children.has(rest)) {
            children.set(rest, { kind: "file", path: prefix + rest });
          }
          return;
        }
        var directoryName = rest.slice(0, slash);
        children.set(directoryName, {
          kind: "directory",
          path: prefix + directoryName + "/",
        });
      });

    for (var child of children.entries()) {
      var name = child[0];
      var info = child[1];
      if (info.kind === "directory") {
        yield new DesktopDirectoryHandle(name, info.path, this._folderId);
      } else {
        yield new DesktopFileHandle(name, info.path, this._folderId);
      }
    }
  };

  DesktopDirectoryHandle.prototype.getDirectoryHandle = async function (
    name,
    options,
  ) {
    var childName = safeName(name);
    var nextPrefix = this._prefix + childName + "/";
    var read = await readSources(this._folderId);
    var exists = Object.keys(read.sources).some(function (filePath) {
      return filePath.startsWith(nextPrefix);
    });
    if (!exists && !(options && options.create)) {
      throw makeError("Directory not found.", "NotFoundError");
    }
    return new DesktopDirectoryHandle(childName, nextPrefix, this._folderId);
  };

  DesktopDirectoryHandle.prototype.getFileHandle = async function (
    name,
    options,
  ) {
    var childName = safeName(name);
    var filePath = this._prefix + childName;
    var read = await readSources(this._folderId);
    if (
      !Object.prototype.hasOwnProperty.call(read.sources, filePath) &&
      !(options && options.create)
    ) {
      throw makeError("File not found.", "NotFoundError");
    }
    return new DesktopFileHandle(childName, filePath, this._folderId);
  };

  DesktopDirectoryHandle.prototype.removeEntry = async function (name, options) {
    if (typeof bridge.deleteFile !== "function") return;
    var target = pathFor(this._prefix, name);
    var targets = [target];
    if (options && options.recursive) {
      var read = await readSources(this._folderId);
      var directoryPrefix = target + "/";
      targets = Object.keys(read.sources).filter(function (filePath) {
        return filePath === target || filePath.startsWith(directoryPrefix);
      });
      if (targets.length === 0) {
        throw makeError("Entry not found.", "NotFoundError");
      }
    }
    for (var i = 0; i < targets.length; i += 1) {
      var result = await bridge.deleteFile({
        folderId: this._folderId,
        path: targets[i],
      });
      if (!result || !result.ok) throw actionError(result, "Delete failed.");
    }
  };

  DesktopDirectoryHandle.prototype.queryPermission = async function () {
    return "granted";
  };

  DesktopDirectoryHandle.prototype.requestPermission = async function () {
    return "granted";
  };

  DesktopDirectoryHandle.prototype.isSameEntry = async function (other) {
    return Boolean(
      other &&
        other.kind === "directory" &&
        other._folderId === this._folderId &&
        other._prefix === this._prefix,
    );
  };

  window.showDirectoryPicker = async function () {
    var result = await bridge.chooseFolder();
    if (!result || !result.ok) {
      throw actionError(result, "Folder selection failed.");
    }
    var folder = result.folder || {};
    return new DesktopDirectoryHandle(
      folder.name || "Local folder",
      "",
      folder.id,
    );
  };

  Object.defineProperty(window, PATCH_KEY, {
    value: true,
    configurable: true,
  });
  return true;
})()`;
}

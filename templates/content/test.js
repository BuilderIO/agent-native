const trimmed = "hero-ideas";
const parentPath = "resource";

let finalName = trimmed;
let finalParent = parentPath;

if (trimmed.includes("/")) {
  const parts = trimmed.split("/").filter(Boolean);
  finalName = parts.pop();
  if (parts.length > 0) {
    const extraPath = parts.join("/");
    finalParent = finalParent ? `${finalParent}/${extraPath}` : extraPath;
  }
}

let logs = [];
if (finalParent && trimmed.includes("/")) {
  const dirs = trimmed.split("/").filter(Boolean);
  dirs.pop();
  let currentPath = parentPath || "";
  for (const dir of dirs) {
    logs.push({ name: dir, parentPath: currentPath || undefined });
    currentPath = currentPath ? `${currentPath}/${dir}` : dir;
  }
}

console.log("finalName:", finalName);
console.log("finalParent:", finalParent);
console.log("logs:", logs);

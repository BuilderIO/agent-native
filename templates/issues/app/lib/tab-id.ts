export const TAB_ID =
  typeof window !== "undefined"
    ? (sessionStorage.getItem("__tab_id") ??
      (() => {
        const id = Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem("__tab_id", id);
        return id;
      })())
    : "server";

import { useSetHeaderActions } from "@agent-native/toolkit/app-shell";
import { useEffect, useState } from "react";
import { Outlet, useMatch } from "react-router";

import Index from "@/pages/Index";

function ClearHeaderActions() {
  useSetHeaderActions(null);
  return null;
}

export default function HomeLayout() {
  const isHome = useMatch("/home") !== null;
  const [homeVisited, setHomeVisited] = useState(isHome);

  useEffect(() => {
    if (isHome) setHomeVisited(true);
  }, [isHome]);

  return (
    <>
      {homeVisited || isHome ? (
        <div hidden={!isHome}>
          <Index active={isHome} />
        </div>
      ) : null}
      <Outlet />
      {!isHome ? <ClearHeaderActions /> : null}
    </>
  );
}

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { HeaderActionsProvider } from "./HeaderActions";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="hidden md:block">
          <Sidebar />
        </div>
        <div className="flex flex-col flex-1 h-full overflow-hidden">
          <MobileNav />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </HeaderActionsProvider>
  );
}

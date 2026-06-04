import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import styles from "./layout.module.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.root}>
      <Sidebar />
      <div className={styles.mainWrapper}>
        <Topbar />
        <main className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}

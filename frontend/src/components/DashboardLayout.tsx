"use client";

import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import { logout } from "@/lib/auth";
import styles from "./DashboardLayout.module.css";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className={styles.layout}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <Image
            src="/RCP.jpg"
            alt="RCP Logo"
            width={40}
            height={40}
            className={styles.logoImage}
          />
          <span className={styles.topBarTitle}>ILI Alignment</span>
        </div>

        <div className={styles.topBarNav}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={
                pathname === item.href ? styles.navLinkActive : styles.navLink
              }
            >
              {item.label}
            </a>
          ))}
          <button onClick={handleLogout} className={styles.logoutBtn}>
            Log Out
          </button>
        </div>
      </div>

      {/* ── Page content ── */}
      <main className={styles.main}>{children}</main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type MenuName = "performance" | "accuracy";

const menuLinkClassName =
  "rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900";

export default function HeaderNav() {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const performanceButtonRef = useRef<HTMLButtonElement>(null);
  const accuracyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || openMenu === null) {
        return;
      }

      const buttonRef =
        openMenu === "performance"
          ? performanceButtonRef
          : accuracyButtonRef;

      setOpenMenu(null);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  function toggleMenu(menu: MenuName) {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
  }

  function closeMenu() {
    setOpenMenu(null);
  }

  return (
    <ul
      ref={navRef}
      className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400"
    >
      <li>
        <Link
          href="/"
          className="font-medium hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={closeMenu}
        >
          Overview
        </Link>
      </li>
      <li className="relative">
        <button
          ref={performanceButtonRef}
          type="button"
          aria-expanded={openMenu === "performance"}
          aria-controls="performance-menu"
          className="cursor-pointer font-medium hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={() => toggleMenu("performance")}
        >
          Performance{" "}
          <span aria-hidden="true" className="ml-1 text-[10px]">
            ▾
          </span>
        </button>
        {openMenu === "performance" ? (
          <div
            id="performance-menu"
            className="absolute right-0 z-50 mt-2 grid min-w-40 gap-1 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <Link
              href="/summary"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              Summary
            </Link>
            <Link
              href="/charts"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              Charts
            </Link>
            <Link
              href="/compare"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              Compare
            </Link>
            <Link
              href="/runs"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              Runs
            </Link>
            <Link
              href="/history"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              History
            </Link>
          </div>
        ) : null}
      </li>
      <li className="relative">
        <button
          ref={accuracyButtonRef}
          type="button"
          aria-expanded={openMenu === "accuracy"}
          aria-controls="accuracy-menu"
          className="cursor-pointer font-medium text-indigo-700 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200"
          onClick={() => toggleMenu("accuracy")}
        >
          Accuracy{" "}
          <span aria-hidden="true" className="ml-1 text-[10px]">
            ▾
          </span>
        </button>
        {openMenu === "accuracy" ? (
          <div
            id="accuracy-menu"
            className="absolute right-0 z-50 mt-2 grid min-w-44 gap-1 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <Link
              href="/accuracy"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              Results
            </Link>
            <Link
              href="/accuracy/run"
              className={menuLinkClassName}
              onClick={closeMenu}
            >
              Run evaluation
            </Link>
          </div>
        ) : null}
      </li>
      <li>
        <Link
          href="/docs"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={closeMenu}
        >
          Docs
        </Link>
      </li>
      <li>
        <a
          href="https://github.com/InferStation/InferStation"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
          title="GitHub"
          className="flex items-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={closeMenu}
        >
          <svg
            viewBox="0 0 16 16"
            width="18"
            height="18"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.69-.01-1.36-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </li>
    </ul>
  );
}

"use client";

/**
 * Two or three panels behind a row of tabs.
 *
 * Every panel is server-rendered and handed over as children; this component
 * only decides which one is visible, so switching is instant and costs no
 * fetch. Hidden panels stay mounted — a half-filled form in one tab survives
 * a glance at another.
 */

import { useState, type ReactNode } from "react";

export default function Tabs({
  tabs,
}: {
  tabs: { label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={i === active}
            className={i === active ? "tab active" : "tab"}
            onClick={() => setActive(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.label} role="tabpanel" hidden={i !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

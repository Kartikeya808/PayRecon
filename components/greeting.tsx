"use client";

import { useEffect, useState } from "react";

export function Greeting({ name }: { name?: string }) {
  const [date, setDate] = useState("");

  useEffect(() => {
    setDate(
      new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    );
  }, []);

  // Neutral, time-independent greeting. Uses the signed-in user's first name
  // when available, otherwise a plain welcome.
  const first = name?.trim().split(/\s+/)[0];

  return (
    <div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 2 }}>
        {date || " "}
      </div>
      <h1 className="page-title">{first ? `Welcome back, ${first}` : "Welcome back"}</h1>
    </div>
  );
}

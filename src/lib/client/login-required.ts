"use client";

import { useEffect, useState } from "react";

/** Whether this install asks for a password. Null until known, so sign-in controls stay hidden rather than flash. */
export function useLoginRequired(): boolean | null {
  const [required, setRequired] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data: { loginRequired?: boolean }) => setRequired(data.loginRequired !== false))
      .catch(() => setRequired(false));
  }, []);
  return required;
}

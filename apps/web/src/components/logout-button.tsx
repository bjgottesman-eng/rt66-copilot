'use client';

import { useState } from 'react';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch('/api/session', { method: 'DELETE' }).finally(() => {
          window.location.assign('/login');
        });
      }}
    >
      Sign out
    </button>
  );
}

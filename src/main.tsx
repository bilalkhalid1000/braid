import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { SettingsProvider } from "./lib/settings";
import { TipProvider } from "./components/Tip";
import { NoticeProvider } from "./lib/notice";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend pushes change events, so nothing here should ever poll.
      refetchOnWindowFocus: false,
      refetchInterval: false,
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TipProvider>
          <NoticeProvider>
            <App />
          </NoticeProvider>
        </TipProvider>
      </SettingsProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

/** A window, not a web page.
 *
 *  Without this a right-click anywhere the app does not handle itself raises
 *  the webview's own menu -- Back, Reload, Save as, Print, Inspect -- which
 *  offers nothing that means anything here and says plainly that the thing you
 *  are using is a browser.
 *
 *  Text fields keep theirs. It is the only route to paste for anyone who does
 *  not reach for the key, and there is nothing in it that misleads. */
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;

  event.preventDefault();
});

/** The window is created hidden and revealed here.
 *
 *  Starting hidden is what removes the blank frame entirely: there is nothing
 *  to see until the first real paint has happened. Two nested frames, because
 *  one only guarantees the work is scheduled, not that it reached the screen.
 *
 *  A failure here would leave an invisible app, so the backend shows the window
 *  unconditionally after a few seconds as a backstop. */
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void getCurrentWindow().show().catch(() => {});
  }),
);

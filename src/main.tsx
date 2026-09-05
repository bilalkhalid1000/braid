import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

// The window starts hidden and App reveals it from its first effect, once the
// splash is in the DOM. It used to be revealed from two nested animation
// frames here, but WebKitGTK runs no animation frames for a window that is
// not shown, so on Linux the frames waited for the backend's five-second
// backstop and every launch took five seconds to appear.

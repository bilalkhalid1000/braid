import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { SettingsProvider } from "./lib/settings";
import { TipProvider } from "./components/Tip";

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
          <App />
        </TipProvider>
      </SettingsProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

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

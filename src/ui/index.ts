/**
 * Interactive UI layer — Ink (React for the terminal).
 * No business logic; receives data and callbacks from the core.
 */

import React from "react";
import { render } from "ink";
import { restoreTerminal } from "../platform/terminal.js";
import { App, type AppProps } from "./App.js";

/**
 * Launch the interactive Ink app.
 * Returns a cleanup function that restores the terminal.
 */
export function renderApp(props: AppProps): () => void {
  const { unmount } = render(React.createElement(App, props));

  const cleanup = () => {
    unmount();
    restoreTerminal();
  };

  return cleanup;
}

export { App };
export type { AppProps };

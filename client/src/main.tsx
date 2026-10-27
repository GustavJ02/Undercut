import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ReplayRoot } from "./dev/Replay";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {import.meta.env.DEV && new URLSearchParams(location.search).has("replay") ? <ReplayRoot /> : <App />}
  </StrictMode>,
);

/** Mount point. Everything else in this directory is one module, one file.
 *  The stylesheet is imported rather than linked so Vite and Tailwind own it
 *  too -- one build graph, and editing it hot-reloads like the components do. */
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./compare.css";

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from the shell");
createRoot(host).render(<App />);

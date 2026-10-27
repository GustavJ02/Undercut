import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, GlossScope, type Term } from "../glossary";

const Scope = createContext<GlossScope | null>(null);

/** One screen's glossary: inside it, each term is explained the first time it appears. */
export function GlossaryScope({ children }: { children: ReactNode }) {
  const scope = useMemo(() => new GlossScope(), []);
  return <Scope.Provider value={scope}>{children}</Scope.Provider>;
}

/** A term with a short explanation, on hover, focus and tap. Only the first use of a term in the screen's scope gets it; the others are plain text. */
export function Gloss({ term, children }: { term: Term; children?: ReactNode }) {
  const scope = useContext(Scope);
  const id = useId();
  const first = scope?.claim(term, id) ?? false;
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  if (!first) return <>{children ?? term}</>;
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setAt({ x: Math.min(Math.max(r.left, 8), window.innerWidth - 280), y: r.bottom + 6 });
  };
  const hide = () => {
    if (!pinned) setAt(null);
  };
  return (
    <>
      <span
        className="gloss"
        tabIndex={0}
        role="button"
        aria-label={`${term}: ${GLOSSARY[term]}`}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => {
          setPinned(false);
          setAt(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (pinned) {
            setPinned(false);
            setAt(null);
          } else {
            setPinned(true);
            show(e.currentTarget);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setPinned(false);
            setAt(null);
          }
        }}
      >
        {children ?? term}
      </span>
      {at && createPortal(<span className="gloss-tip" role="tooltip" style={{ left: at.x, top: at.y }}>{GLOSSARY[term]}</span>, document.body)}
    </>
  );
}

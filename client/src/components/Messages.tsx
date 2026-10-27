import { useStickToBottom } from "../hooks";
import type { Message } from "../state";

export function Messages({ messages }: { messages: Message[] }) {
  const stick = useStickToBottom<HTMLElement>(messages.length);
  return (
    <section className="messages" aria-label="Messages" ref={stick.ref} onScroll={stick.onScroll}>
      <h3>Race control and radio</h3>
      <ul>
        {[...messages].reverse().map((m) => (
          <li key={m.key} className={`msg-${m.level}`}>
            {m.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

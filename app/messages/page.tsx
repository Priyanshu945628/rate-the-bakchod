import { MessageIcon } from "@/components/icons";

/**
 * The right-hand pane with nothing open.
 *
 * Hidden below `lg`, where the list is the whole screen and this would be a second
 * screen the reader has to get past to reach it.
 */
export default function MessagesIndexPage() {
  return (
    <section className="panel chat-glow hidden flex-1 flex-col items-center justify-center gap-2 lg:flex">
      <MessageIcon className="h-6 w-6 text-faint" />
      <p className="text-sm text-faint">Pick a conversation.</p>
    </section>
  );
}

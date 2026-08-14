export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main id="main-content" tabIndex={-1} className="h-screen overflow-hidden bg-zinc-50">{children}</main>;
}

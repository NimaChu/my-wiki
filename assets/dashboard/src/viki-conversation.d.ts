export function conversationToMarkdown(conversation: unknown, labels?: Record<string, string>): string;
export function conversationFilename(title: string): string;
export function conversationExportBundle(conversation: unknown, labels?: Record<string, string>): {
  markdown: string;
  markdownFilename: string;
  archiveFilename: string;
  images: Array<{ path: string; archivePath: string }>;
};
export function conversationNoteBundle(conversation: unknown, labels?: Record<string, string>): {
  title: string;
  markdown: string;
  images: Array<{ path: string; archivePath: string }>;
};

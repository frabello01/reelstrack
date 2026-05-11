import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';
import {
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3,
  Quote, Code, Link as LinkIcon, Image as ImageIcon, Undo, Redo, Strikethrough
} from 'lucide-react';
import './GuideEditor.css';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Wrapper around TipTap configured for SOP-style content.
 *
 * Props:
 *  - content     — JSON document (TipTap format) or null
 *  - onChange    — called with { content: <json>, content_text: <plain text> }
 *  - onImageUpload — async (file: File) => string  (returns public URL)
 *  - editable    — boolean (default true)
 *  - placeholder — placeholder text when empty
 */
export default function GuideEditor({ content, onChange, onImageUpload, editable = true, placeholder = 'Start writing…' }) {
  // Use a ref to always read the latest onChange (avoids stale closures inside TipTap's onUpdate)
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: content || '',
    editable,
    onUpdate: ({ editor }) => {
      onChangeRef.current?.({
        content: editor.getJSON(),
        content_text: editor.getText(),
      });
    },
  });

  // If parent updates `content` (e.g. loading from server), sync editor.
  // We only sync if the editor is unfocused — otherwise we'd interrupt typing.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(content) && !editor.isFocused) {
      editor.commands.setContent(content || '', false);
    }
  }, [editor, content]);

  // Sync editable prop changes — useEditor only reads this once at mount
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) return null;

  const handleAddImage = async () => {
    if (!onImageUpload) return alert('Image upload is not enabled here');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return alert('Please choose a JPG, PNG, WebP, or GIF image.');
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return alert(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
      }
      try {
        const url = await onImageUpload(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch (err) {
        alert(`Image upload failed: ${err.message}`);
      }
    };
    input.click();
  };

  const handleAddLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  if (!editable) {
    return (
      <div className="guide-editor read-only">
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className="guide-editor">
      <div className="guide-editor-toolbar">
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl/Cmd+B)">
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl/Cmd+I)">
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough size={14} />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
          <Heading1 size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <Heading2 size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
          <Heading3 size={14} />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
          <Quote size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
          <Code size={14} />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn onClick={handleAddLink} active={editor.isActive('link')} title="Add link">
          <LinkIcon size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={handleAddImage} title="Insert image">
          <ImageIcon size={14} />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
          <Redo size={14} />
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} className="guide-editor-content" />
    </div>
  );
}

function ToolbarBtn({ children, onClick, active, disabled, title }) {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''}`}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="tb-sep" />;
}

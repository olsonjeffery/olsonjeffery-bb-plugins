import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

export function SpoolerNewSection() {
  const sdk = useSdk();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (open && !pending) inputRef.current?.focus();
  }, [open, pending]);

  const close = () => {
    setOpen(false);
    setName("");
    setError(null);
    triggerRef.current?.focus();
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      // BB's realtime sidebar snapshot supplies the new section to every view.
      const section = await sdk.threadSections.create({ name: trimmed });
      close();
      toast.success(`Created section "${section.name}"`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <div
      className="spooler-section-create"
      onKeyDown={(event) => {
        // Section controls must not archive/pin the last keyboard-focused row.
        event.stopPropagation();
        if (event.key === "Escape" && open) {
          event.preventDefault();
          if (!submitting.current) close();
        }
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Icon name="Plus" aria-hidden="true" />
        New section
      </Button>
      {open ? (
        <form
          id={id}
          aria-label="New section"
          aria-busy={pending}
          className="spooler-section-create-form"
          onSubmit={create}
        >
          <Input
            ref={inputRef}
            className="spooler-section-create-input"
            aria-label="Section name"
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
            placeholder="Section name…"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            required
          />
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create section"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={close}>
            Cancel
          </Button>
          {error ? (
            <p id={`${id}-error`} role="alert" className="spooler-section-create-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

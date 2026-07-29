"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

const controlBase =
  "w-full bg-white border rounded-sm px-3.5 text-body text-ink placeholder:text-muted " +
  "transition-colors duration-150 ease-out outline-none " +
  "focus:border-ink focus:ring-2 focus:ring-ink/10 " +
  "disabled:bg-surface disabled:text-muted";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}

function FieldShell({
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-caption font-medium text-ink-soft">
        {label}
        {required && <span className="text-sale"> *</span>}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {/* Error replaces the hint rather than stacking, so the form never
          reflows as the user fixes fields. */}
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-sale">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
};

export function Input({
  label,
  hint,
  error,
  required,
  className,
  wrapperClassName,
  ...rest
}: InputProps) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            controlBase,
            "h-12",
            invalid ? "border-sale" : "border-line",
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

type TextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> & {
  label: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
};

export function Textarea({
  label,
  hint,
  error,
  required,
  className,
  wrapperClassName,
  rows = 3,
  ...rest
}: TextareaProps) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={rows}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            controlBase,
            "py-3 resize-y leading-relaxed",
            invalid ? "border-sale" : "border-line",
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
};

export function Select({
  label,
  hint,
  error,
  required,
  className,
  wrapperClassName,
  children,
  ...rest
}: SelectProps) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            controlBase,
            "h-12 appearance-none pr-9",
            invalid ? "border-sale" : "border-line",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

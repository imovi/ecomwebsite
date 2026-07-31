"use client";

import { useId, useMemo, useRef, useState } from "react";
import { searchAreas } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * Free-text area field with thana/district suggestions.
 *
 * The customer can always type anything — suggestions only make the common
 * case faster and, more importantly, increase the chance we recognise the area
 * well enough to pre-select the right delivery zone. Nothing here is
 * mandatory: an unrecognised area just means the zone selector starts empty.
 */
export function AreaField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = useMemo(() => searchAreas(value), [value]);
  const open = focused && !dismissed && suggestions.length > 0;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-ink-soft">
        {copy.checkout.area}
        <span className="text-sale"> *</span>
      </label>

      <div
        className={cn(
          "flex items-center gap-2 rounded-sm border bg-white px-3.5",
          error ? "border-sale" : "border-line focus-within:border-ink",
        )}
      >
        <Icon name="location" size={18} className="shrink-0 text-muted" />
        <input
          id={id}
          data-field="areaText"
          value={value}
          required
          autoComplete="address-level2"
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={Boolean(error) || undefined}
          /* combobox rather than the implicit textbox role — textbox does not
             support aria-expanded. */
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          placeholder={copy.checkout.areaPlaceholder}
          onChange={(e) => {
            onChange(e.target.value);
            setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delayed so a click on a suggestion registers before we close.
            blurTimer.current = setTimeout(() => setFocused(false), 120);
          }}
          className="h-12 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted"
        />
      </div>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-sm border border-line bg-white py-1 shadow-card"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                role="option"
                aria-selected={suggestion === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  onChange(suggestion);
                  setDismissed(true);
                  setFocused(false);
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-caption text-ink transition-colors hover:bg-surface"
              >
                <Icon name="location" size={15} className="text-muted" />
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption text-sale">
          {error}
        </p>
      ) : (
        <p className="text-caption text-muted">
          Type your area, thana or district.
        </p>
      )}
    </div>
  );
}

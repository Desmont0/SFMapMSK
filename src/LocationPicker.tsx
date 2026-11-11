import { useEffect, useId, useRef, useState } from 'react';
import { locationById, searchLocations } from '../shared/locations';
export function LocationPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState(locationById.get(value)?.label || '');
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), id = useId();
  const options = searchLocations(query);
  useEffect(() => { if (value) setQuery(locationById.get(value)?.label || ''); }, [value]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, []);
  function choose(index: number) { const place = options[index]; if (!place) return; onChange(place.id); setQuery(place.label); setOpen(false); }
  return <div className="location-picker" ref={root}>
    <label htmlFor={id}>Район или город * </label>
    <input id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={id + '-options'} aria-activedescendant={open && options[active] ? id + '-' + active : undefined}
      placeholder="Москва, Яс… или Зеленоград" value={query} required
      onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); if (value) onChange(''); }}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, options.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
        if (e.key === 'Enter' && open) { e.preventDefault(); choose(active); }
        if (e.key === 'Escape') setOpen(false);
        if (e.key === 'Tab') setOpen(false);
      }} />
    {open && <div className="location-options" id={id + '-options'} role="listbox" aria-label="Подходящие места">
      {options.map((place, index) => <button type="button" role="option" id={id + '-' + index} key={place.id} aria-selected={index === active} onPointerMove={() => setActive(index)} onClick={() => choose(index)}><span>{place.label}</span><small>{place.kind === 'district' ? 'Район Москвы' : 'Город'}</small></button>)}
      {!options.length && <p>Ничего не найдено. Введите район Москвы или город области.</p>}
    </div>}
    <p className="field-hint">Выберите подсказку. На карте показывается общий центр района или города.</p>
  </div>;
}

// Presentation helpers are separate from validation so the public map does not
// download the administrative location catalog.
export const kindLabels = { person: 'Участник', garage: 'Гараж', service: 'Сервис', meetup: 'Место встречи' } as const;
export type EntryKind = keyof typeof kindLabels;
export const kindIcons: Record<EntryKind, string> = { person: '', garage: '⌂', service: '⚒', meetup: '⚑' };
export function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase(); }

const equivalents: Record<string, string> = { А:'A', В:'B', Е:'E', К:'K', М:'M', Н:'H', О:'O', Р:'P', С:'C', Т:'T', У:'Y', Х:'X' };
export function normalizePlate(value: string) { return value.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, c => equivalents[c]).replace(/[^A-ZА-Я0-9]/g, ''); }
export function matchesPlate(plate: string, query: string) {
  const needle = normalizePlate(query);
  if (!needle) return false;
  const value = normalizePlate(plate);
  return /^\d+$/.test(needle) ? value.replace(/\D/g, '').includes(needle) : value.includes(needle);
}

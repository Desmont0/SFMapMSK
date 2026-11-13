export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch { /* HTTP or embedded browser. */ }
  }
  const field=document.createElement('textarea');
  field.value=value;field.readOnly=true;field.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.append(field);field.select();field.setSelectionRange(0,value.length);
  try {return document.execCommand('copy');} catch {return false;} finally {field.remove();}
}

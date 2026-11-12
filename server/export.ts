import { fields, fieldLabels, kindLabels, type Participant } from '../shared/participant.ts';

// JSON values preserve line breaks and separators without making the dump ambiguous.
export function exportText(participants: Participant[], photos: {participant_id:string;data:Uint8Array;version:string}[] = []) {
  const images = new Map(photos.map(p => [p.participant_id,p]));
  return '\uFEFFSFMap — полный экспорт записей (UTF-8)\n' +
    'Создан: ' + new Date().toISOString() + '\nЗаписей: ' + participants.length +
    '\nЗначения полей записаны как JSON; фотографии — WebP в base64.\nВключает закрытые комментарии и Telegram. Храните файл как резервную копию.\n' +
    participants.map(p => {
      const photo = images.get(p.id);
      return '\n' + '='.repeat(60) + '\n' + fields.map(key => (fieldLabels[key] || key) + ': ' + JSON.stringify(key === 'kind' ? kindLabels[p.kind] : key === 'shareId' ? '/p/'+p.shareId : p[key])).join('\n') +
        '\nФото WebP (base64): ' + (photo ? Buffer.from(photo.data).toString('base64') : 'нет') + '\n';
    }).join('');
}

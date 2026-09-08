import * as crypto from 'crypto';

export function uuidv7(): string {
  const ts = Date.now();
  const tHex = ts.toString(16).padStart(12, '0');
  const rand = crypto.randomBytes(10).toString('hex');
  let hex = (tHex + rand).slice(0, 32);
  const arr = hex.split('');
  arr[12] = '7';
  const v = parseInt(arr[16], 16);
  arr[16] = ((v & 0x3) | 0x8).toString(16);
  return `${arr.slice(0, 8).join('')}-${arr.slice(8, 12).join('')}-${arr.slice(12, 16).join('')}-${arr.slice(16, 20).join('')}-${arr.slice(20, 32).join('')}`;
}

import { readFileSync } from "fs";
const buf = readFileSync("templates/clips/desktop/src-tauri/icons/icon.ico");
console.log("First 16 bytes:", Array.from(buf.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log("File size:", buf.length);
const reserved = buf.readUInt16LE(0);
const type = buf.readUInt16LE(2);
const count = buf.readUInt16LE(4);
console.log("reserved:", reserved, "type:", type, "count:", count);

const PNG_SIG = "89504e470d0a1a0a";
const BMP_SIG = buf.subarray(0,2).toString('hex');
console.log("First 2 bytes hex:", BMP_SIG);

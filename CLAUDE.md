# CLAUDE.md

Panduan untuk Claude Code saat bekerja di repo ini.

## Project

`buddy-pet` adalah plugin (mod) Claude Code. Isinya hewan peliharaan pixel-art kecil di atas prompt yang bereaksi terhadap aktivitas Claude: berpikir, menjalankan tool, menunggu persetujuan, selesai, atau gagal. Plugin juga menampilkan angka konteks, biaya sesi, dan rate limit.

## Struktur

```
.claude-plugin/
  plugin.json          # manifest plugin (name, version, description)
  types/               # type declaration Claude Code (claude-code, -tools, -mcp); gitignored di dalamnya
hooks/
  hooks.json           # daftar modul: ["./register.tsx"]
  register.tsx         # semua logika: event handler, state, command /pet, render UI
  pet-art.ts           # pixel art 12x14, face, warna, pack/paint ke sel terminal
sounds/                # done.wav, ask.wav, fail.wav
tsconfig.json          # extends .claude-plugin/types/tsconfig.json
```

## Perintah

`package.json` hanya untuk script dan TypeScript (devDependency); tidak ada build. Modul dimuat langsung oleh Claude Code. `npm run check` menjalankan tiga langkah di bawah sekaligus.

- Type check: `npm run typecheck` (`tsc -p tsconfig.json`; noEmit, strict, `noUncheckedIndexedAccess`).
- Validasi manifest dan hooks: `claude plugin validate .`.
- Tes: `claude plugin test .` (`hooks/register.test.tsx`; mesin di bawah mod di-stub lewat `engine()`).
- Coba perubahan: reload mod di sesi Claude Code. State modul (variabel top-level) reset saat reload.

## Arsitektur

- `register.tsx` mengekspor `register: Register`; semua handler didaftarkan lewat `on(event, ...)`.
- Event yang dipakai: `session.start`, `turn.start`, `tool.call`, `tool.check`, `classic.PostToolUseFailure`, `turn.complete`, `session.measure`, `classic.SubagentStart/Stop`, `session.compact`, `command.run` (`/pet`), dan `ui.render` (komponen `AbovePrompt`).
- State aktivitas adalah variabel modul (`activity`, `note`, `until`, ...). Ubah lewat `setActivity()`, yang juga memanggil `$.ui.invalidate('ui.render')`.
- `Activity` sementara (happy, alert, surprised) punya `until`; `pickFace()` mengembalikannya ke `idle` setelah lewat. Idle berkembang jadi blink, wink, lirik, tired, atau sleepy.
- Preferensi (`Prefs`) dan total lifetime disimpan di `$.store` (`prefs`, `lifetime`, `history`).
- `pet-art.ts` murni gambar: grid 12x14 piksel, dua piksel per sel terminal (half block), jadi 12x7 sel. Komponen `Raster` hanya ada di surface `terminal`; selain itu jatuh ke `TEXT_FACE` dan satu baris angka.

## Konvensi

- Handler yang tidak boleh mengganggu Claude (`tool.call`, `tool.check`, failure, subagent, compact) diakhiri `.catch(async ($, e, next) => next(e))`. Jaga pola ini: pet rusak tidak boleh memblokir tool call atau mengubah keputusan izin.
- `tool.check` hanya membaca `result.decision`; jangan ubah hasilnya.
- Panggilan `$.store`, `$.session.usage()`, `$.command.register`, dan `$.audio.play` dibungkus try/catch dengan komentar singkat soal fallback. Ikuti gaya itu.
- Komentar bahasa Inggris, singkat, menjelaskan kenapa. Tanpa titik koma, single quote, indent 2 spasi.
- Tema baru: tambah ke `THEMES` di `register.tsx`; teks `USAGE` dibangun otomatis dari key-nya.
- Level peringatan: konteks 70/85/95%, budget 50/80/100%. Ubah di `levelOf()` / `budgetLevel()`.
- Jangan edit `.claude-plugin/types/*`; itu type bawaan Claude Code.
- Jangan hitung biaya dua kali saat hot reload: pakai `baseUsd` / `baselineUsd`.

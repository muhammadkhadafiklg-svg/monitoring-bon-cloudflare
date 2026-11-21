// Meneruskan data CSV dari Google Sheet dengan cache di server tepi Cloudflare.
// Mendukung BON_CSV_URL (tab Data Bon), ARSIP_CSV_URL (tab Arsip) atau ARSIP_IDS, serta MASTER_CSV_URL / MASTER_ID.
const MASTER_ID = '1vcQ8iIARrUS_L1mXcXFu3d6DWWZgqBESBXSm5FsFRKc'; // Kode Store, Nama Store, NAMA FRA, NAMA REGIONAL

function teks(pesan, status) {
  return new Response(pesan, {
    status: status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function linkPublikasi(u, namaVar) {
  u = String(u || '').trim();
  if (!u) throw new Error((namaVar || 'URL CSV') + ' belum diisi di Variables and Secrets.');
  if (/\/(edit|export)|\/gviz\//.test(u)) {
    throw new Error((namaVar || 'URL CSV') + ' harus link Publish to web (format CSV).');
  }
  u = u.replace('/pubhtml', '/pub').replace('output=html', 'output=csv');
  if (!/output=/.test(u)) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'output=csv';
  return u;
}

function petaArsip(s) {
  const out = {};
  String(s || '').split(',').forEach(function (b) {
    const i = b.indexOf('=');
    if (i > 0) out[b.slice(0, i).trim()] = b.slice(i + 1).trim();
  });
  return out;
}

function pilihSumberDanTtl(url, env, nama) {
  if (nama === 'bon') {
    return {
      sumber: linkPublikasi(env.BON_CSV_URL, 'BON_CSV_URL'),
      ttl: 60
    };
  }

  if (nama === 'arsip') {
    const bln = url.searchParams.get('bln') || '';
    if (bln && !/^\d{4}-(0[1-9]|1[0-2])$/.test(bln)) {
      throw new Error('__INVALID_MONTH__');
    }

    // Prioritas 1: Link Publish to web CSV untuk tab 'Arsip' di Spreadsheet utama
    if (String(env.ARSIP_CSV_URL || '').trim()) {
      return {
        sumber: linkPublikasi(env.ARSIP_CSV_URL, 'ARSIP_CSV_URL'),
        ttl: 120
      };
    }

    // Prioritas 2 (opsional): File arsip per tahun melalui ARSIP_IDS (contoh: 2026=ID_FILE)
    if (bln) {
      const id = petaArsip(env.ARSIP_IDS)[bln.slice(0, 4)];
      if (!id) return { kosong: true };
      return {
        sumber: 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?tqx=out:csv&sheet=' + bln,
        ttl: 300
      };
    }

    return { kosong: true };
  }

  if (nama === 'master') {
    const m = String(env.MASTER_CSV_URL || '').trim();
    return {
      sumber: m
        ? (m.indexOf('/pub') >= 0 ? linkPublikasi(m, 'MASTER_CSV_URL') : m)
        : 'https://docs.google.com/spreadsheets/d/' + MASTER_ID + '/export?format=csv' + (env.MASTER_GID ? '&gid=' + encodeURIComponent(env.MASTER_GID) : ''),
      ttl: 600
    };
  }

  return { notFound: true };
}

export async function tangani(request, env, nama, waitUntil) {
  try {
    const url = new URL(request.url);
    if (env.DASH_PIN && url.searchParams.get('pin') !== String(env.DASH_PIN)) {
      return teks('PIN salah.', 401);
    }

    const info = pilihSumberDanTtl(url, env, nama);
    if (info.notFound) return teks('Tidak ditemukan.', 404);
    if (info.kosong) return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });

    const sumber = info.sumber;
    const ttl = info.ttl;
    const lewatiCache = url.searchParams.get('nocache') === '1' ||
      String(request.headers.get('Cache-Control') || '').toLowerCase().indexOf('no-cache') >= 0;

    const cache = caches.default;
    const kunci = new Request(sumber);

    const kirim = function (bodyText, dariCache) {
      return new Response(bodyText, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': lewatiCache ? 'no-store' : 'private, max-age=15',
          'X-Cache-Status': dariCache ? 'HIT' : 'MISS',
          'Access-Control-Allow-Origin': '*'
        }
      });
    };

    if (!lewatiCache) {
      const ada = await cache.match(kunci);
      if (ada) {
        const cachedText = await ada.text();
        if (cachedText && cachedText.trim().length > 0) {
          return kirim(cachedText, true);
        }
      }
    }

    const asal = await fetch(sumber, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
      redirect: 'follow'
    });

    if (!asal.ok) {
      return teks('Sumber data [' + nama + '] gagal dibaca (kode ' + asal.status + ').', 502);
    }

    const contentType = String(asal.headers.get('content-type') || '');
    const csvText = await asal.text();

    if (contentType.indexOf('text/html') >= 0 || /^\s*<!doctype html|<html/i.test(csvText)) {
      return teks('Link mengembalikan halaman web, bukan CSV. Periksa pengaturan publikasi (Publish to web).', 502);
    }

    if (!csvText || csvText.trim().length === 0) {
      return teks('Data CSV kosong.', 502);
    }

    const simpan = new Response(csvText, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, max-age=' + ttl
      }
    });

    if (typeof waitUntil === 'function') {
      waitUntil(cache.put(kunci, simpan));
    }

    return kirim(csvText, false);
  } catch (e) {
    if (e && e.message === '__INVALID_MONTH__') {
      return teks('Bulan tidak valid pada [' + nama + ']: ' + (url.searchParams.get('bln') || ''), 400);
    }
    }
    return teks(e.message || String(e), 500);
  }
}

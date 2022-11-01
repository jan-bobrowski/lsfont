/* Parse TTF & WOFF fonts © 2021, 2022 Jan Bobrowski */

if (typeof exports == 'object') {
	exports.font_info = font_info
	inflate = require('./inflate.m').inflate
}

/*
 tables:
  true: required
  false: optional
  missing: ignored
 Replaced with actual table raw data.
 eg. tables = { head: true, maxp: true, cmap: true, name: true, GPOS: false, GSUB: false }
*/

function font_info(body, tables) {
	const g16 = (b,o) => b[o]<<8 | b[o + 1]
	const g16s = (b,o) => (g16(b, o) ^ 32768) - 32768
	const g32 = (b,o) => (g16(b, o)<<16 | g16(b, o + 2)) >>> 0
	const g64 = (b,o) => 65536*65536*g32(b, o) + g32(b, o + 4)
	const gstr = (b,o,n) => String.fromCharCode.apply(String, b.subarray(o, o + n))

	var dir = []
	var v = gstr(body, 0, 4)
	var type
	if (v == '\0\1\0\0' || v == 'true' || v == 'typ1' || v == 'OTTO') {
		dir = [4, 12,16, 8,12]
		type = 'TTF'
	} else if (v == 'wOFF') {
		type = 'WOFF'
		dir = [12, 44,20, 4,8,12]
	} else if (v == 'wOF2')
		throw 'WOFF2 is not supported'
	else
		throw 'Not a font'

	var [ count, pos, step, o_ofs, o_size, o_len ] = dir
	count = g16(body, count)
	if (!count)
		throw 'Bad font'
	do {
		var id = gstr(body, pos, 4)
		if (id in tables) {
			var ofs = g32(body, pos + o_ofs)
			var size = g32(body, pos + o_size)
			if (ofs + size > body.length)
				return 'Font truncated'
			var data = body.slice(ofs, ofs + size)
			if (o_len) {
				var len = g32(body, pos + o_len)
				if (size < len) {
					var zdata = data
					var data = new Uint8Array(len)
					var i = 2, j = 0
					inflate(
						() => zdata[i++],
						v => data[j++] = v
					)
				}
			}
			tables[id] = data
		}
		pos += step
	} while (--count)

	for (var v in tables) {
		var tab = tables[v]
		if (tab && !tab.length)
			throw `No "${v}" table`
	}

	var font = { type }

	var tab = tables.name
	if (tab) {
		var strings = {}
		for (var iter = 0; iter < 2; iter++) {
			var end = 6 + 12*g16(tab, 2)
			for (var pos = 6; pos < end; pos += 12) {
				var [ pe, lang, id ] = [ g32(tab, pos), g16(tab, pos + 4), g16(tab, pos + 6) ]

				// plat enc lang : priority
				// 00030001 0409 : 3 (we prefer English)
				// 00030001 *    : 2
				// 00010000 *    : 1

				var priority =
				 pe == 0x00010000 ? 1 :
				 pe == 0x00030001 ? (lang == 0x0409 ? 3 : 2) : 0

				if (iter == 0) {
					if (priority > (strings[id] || 0))
						strings[id] = priority
				} else {
					if (priority == strings[id]) {
						var ofs = g16(tab, 4) + g16(tab, pos + 10)
						var size = g16(tab, pos + 8)
						strings[id] = new TextDecoder(pe == 0x00030001 ? 'utf-16be' : 'macintosh').decode(tab.slice(ofs, ofs + size))
					}
				}
			}
		}
		font.name = strings[4]
		font.strings = strings
	}

	const read_date = (name, pos) => {
		var d = g64(tab, pos)
		if (d)
			font[name] = new Date(1e3*(d - 2082844800))
	}

	var tab = tables.head
	font.em = g16(tab, 18)
	read_date('created', 20)
	read_date('modified', 28)

	var tab = tables.maxp
	font.num_glyphs = g16(tab, 4)

	var tab = tables.cmap
	var cmap_ofs = []
	var end = 4 + 8*g16(tab, 2)
	for (var pos = 4; pos < end; pos += 8) {
		var pe = g32(tab, pos)
		if (pe == 0x00030001 || pe == 0x0003000a) {
			var offset = g32(tab, pos + 4)
			var format = g16(tab, offset)
			cmap_ofs[format] = offset
		}
	}

	var ranges

	const add_range = (first, last) => {
		var len = last - first + 1
		if (len <= 0)
			return
		var prev = ranges[ranges.length - 1]
		if (prev && prev[0] + prev[1] == first)
			prev[1] += len
		else
			ranges.push([first, len])
	}

	var pos = cmap_ofs[4]
	if (pos) {
		ranges = []
		var v = g16(tab, pos + 6)
		var count = v >> 1
		var o_start = 2 + v
		var o_delta = o_start + v
		var o_ofs = o_delta + v
		pos += 14
		for (; count--; pos += 2) {
			var [last, first, delta, ofs] = [g16(tab, pos), g16(tab, pos + o_start), g16(tab, pos + o_delta), g16(tab, pos + o_ofs)]
			if (!ofs) {
				var i = -delta & 0xFFFF
				if (i >= first && i <= last) {
					add_range(first, i - 1)
					first = i + 1
				}
			} else {
				var array_pos = pos + o_ofs + ofs
				for (var i = first; i <= last; i++) {
					var v = g16(tab, array_pos)
					if (!v || !(v + delta & 0xFFFF)) {
						add_range(first, i - 1)
						first = i + 1
					}
					array_pos += 2
				}
			}
			add_range(first, last)
		}
	}

	var pos = cmap_ofs[12]
	if (pos) {
		ranges = ranges || []
		var count = g32(tab, pos + 12)
		pos += 16
		for (; count--; pos += 12) {
			var [first, last] = [g32(tab, pos), g32(tab, pos + 4)]
			if (cmap_ofs[4] && first < 0x10000)
				first = 0x10000
			add_range(first, last)
		}
	}

	font.ranges = ranges

	var features

	const parse_feature_list = (tab, pos) => {
		features = features || {}
		var featureCount = g16(tab, pos)
		pos += 2
		for (var i = 0; i < featureCount; i++) {
			var featureTag = gstr(tab, pos, 4)
			features[featureTag] = 1
			pos += 6
		}
	}

	var tab = tables.GPOS
	if (tab) {
		if (g16(tab, 0) == 0x0001) {
			var featureListOffset = g16(tab, 6)
			if (featureListOffset)
				parse_feature_list(tab, featureListOffset)
		}
	}

	var tab = tables.GSUB
	if (tab) {
		if (g16(tab, 0) == 0x0001) {
			var featureListOffset = g16(tab, 6)
			if (featureListOffset)
				parse_feature_list(tab, featureListOffset)
		}
	}

	var tab = tables.hhea
	if (tab) {
		font.hhea = {
			ascender: g16s(tab, 4),
			descender: g16s(tab, 6),
			lineGap: g16s(tab, 8)
		}

		var tab = tables['OS/2']
		if (tab) {
			font.os2 = {
				usWeightClass: g16(tab, 4),
				usWidthClass: g16(tab, 6),
				sTypoAscender: g16s(tab, 0x0044),
				sTypoDescender: g16s(tab, 0x0046),
				sTypoLineGap: g16s(tab, 0x0048),
				usWinAscent: g16(tab, 0x004a),
				usWinDescent: g16s(tab, 0x004c)
			}
		}
	}

	if (features)
		font.features = Object.keys(features)

	return font
}

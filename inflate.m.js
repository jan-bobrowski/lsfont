/* Un-deflate implementation © 2009, 2021 Jan Bobrowski */

function inflate(input, output) {
	var undefined

	var hist = new Uint8Array(32768)
	var hist_pos = 0

	function out(v) {
		hist[hist_pos] = v
		hist_pos = hist_pos+1 & 32767
		output(v)
	}

	var bits = 0
	var bit_count = 0
	var codes

	for (;;) {
		var v = get(3)
		if (v & 0b010) {
			if (v & 0b100)
				throw 'Bad code'
			block_01()
		} else {
			if (v & 0b100)
				block_10()
			else {
				got(bit_count & 7)
				var n = get(16)
				get(16)
				while (n--)
					out(get(8))
			}
		}
		if (v & 1)
			return
	}

	function feed() {
		var v = input()
		if (v == undefined)
			throw 'Truncated'
		bits |= v << bit_count
		bit_count += 8
	}

	function get(n) {
		while (bit_count < n)
			feed()
		var v = bits & (1 << n)-1
		got(n)
		return v
	}

	function got(n) {
		bits >>= n
		bit_count -= n
	}

	function gen_ht(l) {
		var t = new Uint32Array(32768)
		var c = 0
		l.forEach((a,w) => {
			var s = 1 << w
			a.forEach(v => {
				var i = c
				var x = v>>4 & 15
				v |= w
				if (!x || x + w > 15) {
					do {
						t[i] = v
						i += s
					} while (i < 32768)
				} else {
					v = v&~255 | w+x
					var a = 0
					var m = (1 << 8+x)-1
					do {
						t[i] = v + a
						a = a+256 & m
						i += s
					} while (i < 32768)
				}
				c = rev_add(c, s>>1)
			})
		})

		if (typeof global == 'object' && global.debug) {
			for (var v=0; v<32768; v++) {
				var w0 = t[v] & 15
				var n = 1
				var c = t[v & (1 << n)-1]
				if (!c) continue
				var w = c & 15
				if (!w) throw `w=0`
				while (n < w) {
					n = w
					c = t[v & (1 << n)-1]
					w = c & 15
					if (!w) throw `w=0`
				}
				if (w < w0)
					throw `Got width ${w} < ${w0}`
			}
		}

		return t

		function rev_add(a, b) {
			for (;;) {
				var c = a & b;
				a ^= b
				if (!c)
					return a
				b = c >> 1
			}
		}
	}

	function ht_get(ht) {
		var c = ht[bits & 32767]
		if (!c)
			throw 'Bad code'
		var w = c & 15
		if (!w && typeof global == 'object' && global.debug)
			 throw 'Width of zero'
		while (bit_count < w) {
			// Width may shrink, so take one byte at a time
			feed()
			c = ht[bits & 32767]
			if (!c)
				throw 'Bad code'
			w = c & 15
			if (!w && typeof global == 'object' && global.debug)
				 throw 'Width of zero'
		}
		got(w)
		var x = c & 0xf0
		c >>= 8
		if (x)
			c += get(x >> 4)
		return c
	}

	/*
	w: num. bits (added later)
	a: additional bits (to add to code)
	ht0
	 00000000 00000000 nnnnnnnn aaaawwww  literal
	 00000001 00000000 00000000 aaaawwww  end
	 00000001 llllllll llllllll aaaawwww  length
	ht1
	 00000000 oooooooo oooooooo aaaawwww  offset (0-based)
	*/

	function gen_codes() {
		var a = []
		for (var i=0; i<256; i++)
			a.push(i<<8)
		a.push(0x1000000) // the end
		fill(0x1000300, 4, 6)
		a.push(0x1010200, 0x1000000, 0x1000000)
		fill(0x100, 2, 14)
		a.push(0,0)
		codes = a

		function fill(v, rr, n) {
			var m = 1 << 8
			var r = 2*rr
			do {
				do {
					a.push(v)
					v += m
				} while (--r)
				m <<= 1
				v += 16
				r = rr
			} while (--n)
		}
	}

	function decode(ht0, ht1) {
		for (;;) {
			var v = ht_get(ht0)
			if (v < 256)
				out(v)
			else {
				v &= 0xFFFF
				if (!v)
					break
				var l = v
				v = ht_get(ht1)
				if (!v && typeof global == 'object' && global.debug)
					throw 'Bad data'
				var i = hist_pos-v & 32767
				do {
					out(hist[i])
					i = i+1 & 32767
				} while (--l)
			}
		}
	}

	function block_01() {
		if (!codes)
			gen_codes()

		decode(
			gen_ht([,,,,,,, gen(256,279), gen(280,287, gen(0,143)), gen(144,255)]),
			gen_ht([,,,,, gen(288,319)])
		)

		function gen(s, e, a) {
			a = a || []
			for (var i=s; i<=e; i++)
				a.push(codes[i])
			return a
		}
	}

	function block_10() {
		var v = get(14)
		var hlit = v & 31
		var hdist = v>>5 & 31
		var hclen = v>>10
		var l = []
		var n = hclen + 4

		if (n) do {
			v = get(3)
			l.push(v)
		} while (--n)

		var hhr = [
		 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
		]

		var hhc = [
		 0x000, 0x100, 0x200, 0x300, 0x400, 0x500, 0x600, 0x700,
		 0x800, 0x900, 0xA00, 0xB00, 0xC00, 0xD00, 0xE00, 0xF00,
		 0x10320, 0x20330, 0x20B70
		]

		var a = []
		for (var i=0; i<l.length; i++)
			a[hhr[i]] = l[i]

		var l = []
		for (i=0; i<a.length; i++) {
			var v = a[i]
			if (v)
				(l[v] || (l[v] = [])).push(hhc[i])
		}

		var ht = gen_ht(l)
		l = []
		i = 0
		n = hlit + 257

		if (!codes)
			gen_codes()

		var pv, l0
loop:
		for (;;) {
			var v = ht_get(ht)
			var k = 1
			if (v >= 0x100) {
				k = v & 0xFF
				v = v < 0x200 ? pv : 0
			}
			pv = v

			var a = v ? l[v] || (l[v] = []) : undefined
			while (k >= n) {
				k -= n
				if (a) do
					a.push(codes[i++])
				while (--n)
				if (l0)
					break loop
				l0 = l
				l = []
				i = 288
				n = hdist + 1
				if (!k)
					continue loop
				if (a)
					a = l[v] = []
			}
			n -= k
			if (a) {
				do
					a.push(codes[i++])
				while (--k)
			} else
				i += k
		}
		if (k) throw "Bad Huffman data"

		decode(
			gen_ht(l0),
			gen_ht(l)
		)
	}
}

if (typeof exports == 'object')
	exports.inflate = inflate

/* Assemble HTML and JS with compression © 2021 Jan Bobrowski */

fs = require('fs')
clean_css = require('clean-css')
uglify_js = require('uglify-js')

args = process.argv.slice(2)
if (!args[0])
	process.exit(0)

html = fs.readFileSync(args[0], 'utf-8')

html = html.replace(/<style>([\S\s]*?)<\/style>/g, (m0,s) => {
	var ccss = new clean_css({
		level: 2,
		removeEmpty: true
	}).minify(s)
	if (ccss.errors.length)
		console.error(ccss.errors)
	if (ccss.warnings.length)
		console.warn(ccss.warnings)
	s = ccss.styles
	if (s)
		s = `\n${s}\n`
	return `<style>${s}</style>`
})

scripts = []
html = html.replace(/<script src=([^>]+)><\/script>\n?/g, (m0,src) => {
	scripts.push(src)
	return ''
})

html = html.replace(/<script>([\S\s]*?)<\/script>/g, (m0,js) => {
	var m = js.match(/\s*\/\* !INCLUDE \*\/\n?/)
	if (m) {
		js = js.substr(0, m.index)
		+ scripts.map(n => `\n// file ${n} start\n` + fs.readFileSync(n, 'utf-8') + `\n// file ${n} end\n`).join('')
		+ js.substr(m.index + m[0].length)
		scripts = []
	}

	var ujs = uglify_js.minify(js, {
//		warnings: true,
		compress: {
			passes: 2,
			global_defs: {
				exports: false,
				global: false
			}
		}
	})
	var warnings = ujs.warnings
	if (warnings) {
		warnings = warnings.join('\n')
		if (warnings)
			console.log(warnings)
	}
	if (ujs.error)
		throw ujs.error

	return `<script>\n${ujs.code.replace(/;$/,'')}\n</script>`
})

if (args[1])
	fs.writeFileSync(args[1], html)
else
	process.stdout.write(html)


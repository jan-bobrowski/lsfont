
release/lsfont.html: lsfont.html assemble.js font-info.m.js
	@install -d $(@D)
	node assemble.js $< $@

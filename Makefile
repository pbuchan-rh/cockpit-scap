# cockpit-scap Makefile
#
# Targets:
#   install       Install module files and configure SELinux (requires root)
#   uninstall     Remove module files; runtime data is preserved (requires root)
#   help          Show available targets

PREFIX       ?= /usr
COCKPIT_DIR   = $(PREFIX)/share/cockpit/cockpit-scap
DATA_DIR      = /var/lib/cockpit-scap
SELINUX_CTX   = cockpit_var_lib_t
SELINUX_PATH  = /var/lib/cockpit-scap(/.*)?

MODULE_FILES  = index.html index.js style.css manifest.json viewer.html

.PHONY: help install uninstall

help:
	@echo "cockpit-scap"
	@echo ""
	@echo "Targets:"
	@echo "  install     Install module and configure SELinux (requires root)"
	@echo "  uninstall   Remove module files, preserve runtime data (requires root)"
	@echo ""
	@echo "Variables:"
	@echo "  PREFIX      Installation prefix (default: /usr)"

install:
	@echo ">>> Installing cockpit-scap..."

	@echo "--- Creating runtime directories"
	install -d -m 755 $(DATA_DIR)
	install -d -m 755 $(DATA_DIR)/results
	install -d -m 755 $(DATA_DIR)/tailoring
	install -d -m 755 $(DATA_DIR)/content

	@echo "--- Installing module files"
	install -d -m 755 $(COCKPIT_DIR)
	install -m 644 $(MODULE_FILES) $(COCKPIT_DIR)/

	@echo "--- Configuring SELinux file context"
	semanage fcontext -a -t $(SELINUX_CTX) '$(SELINUX_PATH)' 2>/dev/null || \
		semanage fcontext -m -t $(SELINUX_CTX) '$(SELINUX_PATH)'
	restorecon -Rv $(DATA_DIR)

	@echo ""
	@echo ">>> cockpit-scap installed successfully."
	@echo "    Reload Cockpit and navigate to SCAP Compliance in the sidebar."

uninstall:
	@echo ">>> Uninstalling cockpit-scap..."

	@echo "--- Removing module files"
	rm -rf $(COCKPIT_DIR)

	@echo "--- Removing SELinux file context"
	semanage fcontext -d '$(SELINUX_PATH)' 2>/dev/null || true

	@echo ""
	@echo ">>> cockpit-scap removed."
	@echo "    Runtime data preserved at $(DATA_DIR)"
	@echo "    To remove runtime data: rm -rf $(DATA_DIR)"

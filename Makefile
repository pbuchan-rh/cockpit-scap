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

SRC_DIR       = src
MODULE_FILES  = index.html index.js settings.js container-scan.js dashboard.js style.css manifest.json viewer.html

DEV_HOST     ?= rhel10cis
DEV_PATH      = ~/.local/share/cockpit/cockpit-scap

.PHONY: help install uninstall deploy watch

help:
	@echo "cockpit-scap"
	@echo ""
	@echo "Targets:"
	@echo "  install     Install module and configure SELinux (requires root)"
	@echo "  uninstall   Remove module files, preserve runtime data (requires root)"
	@echo "  deploy      Rsync src/ to DEV_HOST user-space and restart Cockpit"
	@echo "  watch       Watch src/ for changes and auto-deploy to DEV_HOST (requires: dnf install entr)"
	@echo ""
	@echo "Variables:"
	@echo "  PREFIX      Installation prefix (default: /usr)"
	@echo "  DEV_HOST    Target host for deploy/watch (default: rhel10cis)"

deploy:
	rsync -av $(SRC_DIR)/ $(DEV_HOST):$(DEV_PATH)/
	ssh $(DEV_HOST) "sudo -n systemctl restart cockpit && echo 'Cockpit restarted'"

watch:
	@echo "Watching src/ — auto-deploying to $(DEV_HOST) on save. Ctrl-C to stop."
	find $(SRC_DIR)/ | entr rsync -av $(SRC_DIR)/ $(DEV_HOST):$(DEV_PATH)/

install:
	@echo ">>> Installing cockpit-scap..."

	@echo "--- Creating runtime directories"
	install -d -m 755 $(DATA_DIR)
	install -d -m 755 $(DATA_DIR)/results
	install -d -m 755 $(DATA_DIR)/tailoring
	install -d -m 755 $(DATA_DIR)/content
	install -d -m 755 $(DATA_DIR)/remediation-logs

	@echo "--- Installing module files"
	install -d -m 755 $(COCKPIT_DIR)
	install -m 644 $(addprefix $(SRC_DIR)/, $(MODULE_FILES)) $(COCKPIT_DIR)/

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
	rm -rf $(PREFIX)/share/cockpit-scap

	@echo "--- Removing SELinux file context"
	semanage fcontext -d '$(SELINUX_PATH)' 2>/dev/null || true

	@echo ""
	@echo ">>> cockpit-scap removed."
	@echo "    Runtime data preserved at $(DATA_DIR)"
	@echo "    To remove runtime data: rm -rf $(DATA_DIR)"

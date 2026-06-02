PORT ?= 8000

.PHONY: serve check ports stop-local

serve:
	python3 -m http.server $(PORT)

check:
	git diff --check
	test -f index.html
	test -f index.css
	test -f assets/favicon.svg
	test -f assets/brianandfrannie.jpg
	test -f assets/frannie.jpeg
	test -f assets/frannie-day.jpg
	test -f assets/frannie-veteran.jpg
	@if rg -n "Photo Coming Soon|Goes Here|Replace|YOUR_|href=\"#\"|frannie@example|123-4567|2025|TODO" index.html index.css README.md; then \
		echo "Placeholder-like text found"; \
		exit 1; \
	fi

ports:
	@for port in 8000 8001 8002; do \
		pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN); \
		if [ -n "$$pids" ]; then \
			echo "Port $$port: $$pids"; \
		else \
			echo "Port $$port: clear"; \
		fi; \
	done

stop-local:
	@for port in 8000 8001 8002; do \
		pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN); \
		if [ -n "$$pids" ]; then \
			echo "Stopping port $$port: $$pids"; \
			kill $$pids; \
		else \
			echo "Port $$port already clear"; \
		fi; \
	done

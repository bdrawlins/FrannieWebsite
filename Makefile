PORT ?= 8000

.PHONY: config serve check ports stop-local

config:
	python3 scripts/build_site_config.py

serve: config
	python3 -m http.server $(PORT)

check:
	git diff --check
	test -f .env.example
	test -f .github/workflows/deploy-pages.yml
	test -f index.html
	test -f index.css
	test -f scripts/build_site_config.py
	test -f google-calendar-booking.gs
	test -f assets/favicon.svg
	test -f assets/brianandfrannie.jpg
	test -f assets/frannie.jpeg
	test -f assets/frannie-day.jpg
	test -f assets/frannie-veteran.jpg
	test -f assets/frannie-paint.jpeg
	test -f assets/happycustomer1.jpeg
	test -f assets/happycustomer2.jpeg
	test -f assets/happycustomer3.jpeg
	test -f assets/happycustomer4.jpg
	test -f assets/happycustomer5.jpeg
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

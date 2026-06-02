# FrannieWebsite
Website for Frannie the Clown

## Local development

Start a local preview server:

```sh
make serve
```

Then open http://localhost:8000.

Use a different port when needed:

```sh
make serve PORT=8002
```

Check the site before pushing:

```sh
make check
```

See or stop local preview servers on ports 8000-8002:

```sh
make ports
make stop-local
```

## Mobile smoke check

Before pushing, preview these viewport widths in the browser dev tools:

- 390px wide for common phones
- 768px wide for tablets
- 1280px wide for desktop

Confirm the navigation is reachable, the hero buttons stack cleanly, the
booking form is one column on mobile, and gallery images remain square.

---
name: ascii-art
description: Generate ASCII art banners and text using FIGlet fonts. Create stylized terminal headers, banners, and decorative text for CLI applications.
---

Generate ASCII art banners using FIGlet fonts. This skill creates stylized text for terminal headers, splash screens, and decorative output.

## Quick Reference

| Task | Command |
|------|---------|
| Generate banner | `figlet "text"` |
| List fonts | `figlet --list.fonts` |
| Custom font | `figlet -f fontname "text"` |
| Horizontal print | `figlet -H "text"` |
| Right-to-left | `figlet -r "text"` |

## FIGlet Font Options

Standard fonts included:
- **Standard** - Default FIGlet font
- **Big** - Large block letters
- **Small** - Compact letters
- **Shadow** - 3D shadow effect
- **Slant** - Italicized block letters
- **Banner** - Old-style banner font
- **Doom** - Blocky with gaps
- **Lean** - Lean-left style
- **Mini** - Very small font

Extended fonts (additional install):
- **ANSI Shadow** - ANSI-colored shadow
- **Letter** - Block letter style
- **Script** - Handwritten style
- **Soft** - Rounded letters

## Installation

```bash
# Node.js/TypeScript
npm install figlet

# CLI tool
npm install -g figlet-cli
```

## Usage Examples

### Basic Banner
```typescript
import figlet from 'figlet';

figlet.text('HELLO', (err, data) => {
    console.log(data);
});
```

### Synchronous
```typescript
const result = figlet.textSync('World', {
    font: 'Slant',
    horizontalLayout: 'default',
    verticalLayout: 'default'
});
console.log(result);
```

### Custom Options
```typescript
figlet.text('ASCII', {
    font: 'Shadow',
    horizontalLayout: 'full',
    verticalLayout: 'universal',
    width: 120
}, (err, data) => {
    console.log(data);
});
```

## Font Discovery

```typescript
import { fonts } from 'figlet';

console.log(fonts.join('\n'));
```

## Common Patterns

### CLI Banner Generator
```typescript
import figlet from 'figlet';

function createBanner(text: string, font = 'Big'): string {
    return figlet.textSync(text, { font });
}

// Usage
console.log(createBanner('PK-PZLD', 'Slant'));
console.log(createBanner('AI', 'Big'));
```

### Random Font Selection
```typescript
import figlet from 'figlet';

function randomFont(): string {
    const fonts = ['Big', 'Block', 'Slant', 'Shadow', 'Small'];
    return fonts[Math.floor(Math.random() * fonts.length)];
}

const art = figlet.textSync('Hello', { font: randomFont() });
```

### Colored Output
```typescript
import figlet from 'figlet';
import chalk from 'chalk';

function colorBanner(text: string): string {
    const art = figlet.textSync(text, { font: 'Big' });
    return chalk.cyan(art);
}
```

## Project Integration

Use ASCII art for:
- CLI startup banners
- Command headers
- Section dividers
- Error/warning decorations
- Success/failure indicators

### Example: CLI Banner
```typescript
import figlet from 'figlet';

export function printBanner(): void {
    const banner = figlet.textSync('MY-CLI', {
        font: 'Big',
        horizontalLayout: 'full'
    });
    console.log(banner);
    console.log('Version 1.0.0\n');
}
```

## Best Practices

1. **Test readability** - Some fonts are hard to read at small sizes
2. **Consider width** - Long text breaks on narrow terminals
3. **Use consistently** - Pick 2-3 fonts and reuse them
4. **Combine with color** - Use chalk/colors for emphasis
5. **Fallback fonts** - Have a backup for unusual characters

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Missing font | Install extended fonts: `figlet --list.fonts` |
| Character errors | Use standard ASCII characters only |
| Width too narrow | Reduce terminal width or use smaller font |
| Import errors | Use `import figlet from 'figlet'` or `require('figlet')` |

## Resources

- **npm**: https://www.npmjs.com/package/figlet
- **FIGlet fonts**: http://www.figlet.org/fontdb.cgi
- **Examples**: https://github.com/patorjk/figlet.js

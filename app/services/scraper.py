import re
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from .word_count import count_words


def extract_domain(url: str) -> str:
    """Extract domain from URL (e.g., 'nytimes.com')."""
    try:
        hostname = urlparse(url).hostname or ''
        return hostname.replace('www.', '')
    except Exception:
        return ''


def extract_text_and_nav_from_html(html: str) -> tuple:
    """Extract readable content from raw HTML.

    Ported from the original reader_app.py scraper logic.
    Strips scripts, styles, nav, sidebars, then finds the main content
    area and extracts cleaned text.

    Returns:
        tuple: (content_html, title)
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Extract title before cleaning
    title_tag = soup.find('title')
    title = title_tag.get_text(strip=True) if title_tag else ''

    # Remove script/style elements
    for script_or_style in soup(['script', 'style']):
        script_or_style.decompose()

    # Remove navigation and sidebar elements
    for nav in soup.find_all(['nav', 'aside']):
        nav.decompose()
    for leftbar in soup.find_all(
        class_=['sidebar', 'leftbar', 'left-nav', 'leftnavbar']
    ):
        leftbar.decompose()

    # Find main content area
    main = soup.find('main')
    if not main:
        article = soup.find('article')
        if article:
            main = article
        else:
            divs = soup.find_all('div')
            if divs:
                main = max(divs, key=lambda d: len(d.get_text()))
            else:
                main = soup

    # Get text content
    text = main.get_text(separator='\n') if main else soup.get_text(separator='\n')

    # Remove navigation text artifacts
    text = re.sub(r'\bPrevious\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\bNext\b', '', text, flags=re.IGNORECASE)

    # Clean up whitespace
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    text = '\n'.join(lines)

    # Build content HTML from cleaned text
    paragraphs = text.split('\n')
    content_html = ''.join(f'<p>{p}</p>' for p in paragraphs if p.strip())

    # If no title from <title> tag, use first line of content
    if not title and paragraphs:
        title = paragraphs[0][:200]

    return content_html, title


def fetch_and_parse(url: str) -> dict:
    """Fetch URL, extract readable content.

    Returns:
        dict: { title, content_html, word_count, source_domain }
    """
    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/120.0.0.0 Safari/537.36'
        ),
        'Accept': (
            'text/html,application/xhtml+xml,application/xml;'
            'q=0.9,image/webp,*/*;q=0.8'
        ),
        'Accept-Language': 'en-US,en;q=0.9',
    }

    response = requests.get(url, headers=headers, timeout=15)
    response.raise_for_status()

    content_html, title = extract_text_and_nav_from_html(response.text)
    word_count = count_words(content_html)
    source_domain = extract_domain(url)

    return {
        'title': title,
        'content_html': content_html,
        'word_count': word_count,
        'source_domain': source_domain,
    }

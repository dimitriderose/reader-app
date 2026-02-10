

from flask import Flask, render_template_string, request, redirect
import os

import requests
from bs4 import BeautifulSoup
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

app = Flask(__name__)

TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Reader App</title>
    <style>
        body { font-family: Arial, sans-serif; background: #222; color: #eee; margin: 0; padding: 0; }
        .container { max-width: 800px; margin: 40px auto; background: #333; padding: 32px; border-radius: 8px; box-shadow: 0 2px 8px #0008; }
        h1 { text-align: center; }
        textarea { width: 100%; height: 200px; margin-bottom: 16px; }
    .reader { font-size: 1.2em; line-height: 1.3; background: #222; padding: 24px; border-radius: 8px; }
        .controls { text-align: center; margin-bottom: 24px; }
        label { margin-right: 8px; }
        input[type=range] { width: 200px; }
        .input-group { margin-bottom: 16px; }
        .nav-btns { text-align: center; margin: 24px 0; }
        .nav-btns a { color: #fff; background: #444; padding: 8px 24px; border-radius: 6px; text-decoration: none; margin: 0 12px; font-weight: bold; }
        .nav-btns a:hover { background: #666; }
    </style>
    <script>
        function updateFontSize(val) {
            document.getElementById('reader').style.fontSize = val + 'px';
            document.getElementById('fontSizeValue').innerText = val + 'px';
        }
    </script>
</head>
<body>
    <div class="container">
        <h1>Reader App</h1>
    <form method="POST" enctype="multipart/form-data" id="readerForm">
            <div class="input-group">
                <label for="file">Upload text file:</label>
                <input type="file" name="file" id="file" accept=".txt,.html">
            </div>
            <div class="input-group">
                <label for="url">Or enter a web link:</label>
                <input type="text" name="url" id="url" style="width:60%" placeholder="https://example.com">
            </div>
            <textarea name="text" placeholder="Paste your text here...">{{ text }}</textarea>
            <div class="controls">
                <label for="fontSize">Font size:</label>
                <input type="range" id="fontSize" min="16" max="36" value="20" oninput="updateFontSize(this.value)">
                <span id="fontSizeValue">20px</span>
            </div>
            <button type="submit">Read</button>
        </form>
        <div id="spinner" style="display:none;text-align:center;margin:32px 0;">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation:spin 1s linear infinite;">
                <circle cx="24" cy="24" r="20" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0.2"/>
                <path d="M44 24c0-11.046-8.954-20-20-20" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
            </svg>
            <div style="margin-top:12px;">Loading...</div>
        </div>
        {% if text %}
        <div class="nav-btns">
            {% if prev_url %}<a href="?url={{ prev_url }}" class="nav-link">Previous</a>{% endif %}
            {% if next_url %}<a href="?url={{ next_url }}" class="nav-link">Next</a>{% endif %}
        </div>
        <div class="reader" id="reader">{{ text.replace('\n', '<br>')|safe }}</div>
        {% endif %}
    </div>
    <script>
        updateFontSize(20);
        // Show spinner on form submit
        document.getElementById('readerForm').addEventListener('submit', function() {
            document.getElementById('spinner').style.display = 'block';
        });
        // Show spinner on nav button click
        document.querySelectorAll('.nav-link').forEach(function(link) {
            link.addEventListener('click', function() {
                document.getElementById('spinner').style.display = 'block';
            });
        });
    </script>
</body>
</html>
'''

def extract_text_and_nav_from_html(html):
    soup = BeautifulSoup(html, 'html.parser')
    for script_or_style in soup(['script', 'style']):
        script_or_style.decompose()
    for nav in soup.find_all(['nav', 'aside']):
        nav.decompose()
    for leftbar in soup.find_all(class_=['sidebar', 'leftbar', 'left-nav', 'leftnavbar']):
        leftbar.decompose()
    main = soup.find('main')
    if not main:
        divs = soup.find_all('div')
        if divs:
            main = max(divs, key=lambda d: len(d.get_text()))
        else:
            main = soup
    # Find next/prev URLs
    next_url = None
    prev_url = None
    # Improved: find by class and text
    next_a = (soup.find('a', rel='next') or
              soup.find('a', string=lambda s: s and 'next' in s.lower()) or
              soup.find('a', class_=lambda c: c and 'next' in c.lower()) or
              soup.find('a', href=True, text=lambda s: s and 'next' in s.lower()))
    prev_a = (soup.find('a', rel='prev') or
              soup.find('a', string=lambda s: s and 'prev' in s.lower()) or
              soup.find('a', class_=lambda c: c and 'prev' in c.lower()) or
              soup.find('a', href=True, text=lambda s: s and 'prev' in s.lower()))
    if not next_a:
        # Try: <small>Next</small> inside <a>
        next_a = soup.find('a', href=True, text=None, attrs={})
        for a in soup.find_all('a', href=True):
            if a.find('small', string=lambda s: s and 'next' in s.lower()):
                next_a = a
                break
    if not prev_a:
        prev_a = soup.find('a', href=True, text=None, attrs={})
        for a in soup.find_all('a', href=True):
            if a.find('small', string=lambda s: s and 'prev' in s.lower()):
                prev_a = a
                break
    if next_a and next_a.has_attr('href'):
        next_url = next_a['href']
    if prev_a and prev_a.has_attr('href'):
        prev_url = prev_a['href']
    text = main.get_text(separator='\n') if main else soup.get_text(separator='\n')
    # Remove navigation text from story content
    import re
    text = re.sub(r'\bPrevious\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\bNext\b', '', text, flags=re.IGNORECASE)
    # Remove anything from "Author's Thoughts" and below
    lower_text = text.lower()
    marker = "author's thoughts"
    idx = lower_text.find(marker)
    if idx != -1:
        text = text[:idx].rstrip()
    # Remove leading/trailing whitespace and extra blank lines
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    # Add a blank line after author name (if present)
    author_idx = None
    for i, line in enumerate(lines):
        if line.lower().startswith('author:') or line.lower().startswith('by '):
            author_idx = i
            break
    if author_idx is not None and author_idx + 1 < len(lines):
        lines.insert(author_idx + 1, '')
    # Add a blank line after the title (first non-empty line)
    title_idx = None
    for i, line in enumerate(lines):
        if line:
            title_idx = i
            break
    if title_idx is not None and title_idx + 1 < len(lines):
        lines.insert(title_idx + 1, '')
    # Mark the title for H1 rendering
    if title_idx is not None:
        lines[title_idx] = f'<h1>{lines[title_idx]}</h1>'
    text = '\n'.join(lines)
    return text, next_url, prev_url

@app.route('/', methods=['GET', 'POST'])
def index():
    text = ''
    next_url = None
    prev_url = None
    url = request.args.get('url')
    if request.method == 'POST' or url:
        file = request.files.get('file') if request.method == 'POST' else None
        if file and file.filename:
            content = file.read().decode('utf-8', errors='ignore')
            if file.filename.endswith('.html'):
                text, next_url, prev_url = extract_text_and_nav_from_html(content)
            else:
                text = content
        elif (request.form.get('url') if request.method == 'POST' else url):
            url_val = request.form.get('url') if request.method == 'POST' else url
            if SELENIUM_AVAILABLE:
                try:
                    chrome_options = Options()
                    driver = webdriver.Chrome(options=chrome_options)
                    driver.get(url_val)
                    html = driver.page_source
                    driver.quit()
                    text, next_url, prev_url = extract_text_and_nav_from_html(html)
                except Exception as e:
                    text = f"Error fetching URL with Selenium: {e}"
            else:
                try:
                    response = requests.get(url_val)
                    response.raise_for_status()
                    text, next_url, prev_url = extract_text_and_nav_from_html(response.text)
                except Exception as e:
                    text = f"Error fetching URL: {e}"
        else:
            text = request.form.get('text', '')
    return render_template_string(TEMPLATE, text=text, next_url=next_url, prev_url=prev_url)

if __name__ == '__main__':
    app.run(debug=True)

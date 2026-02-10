
import sys
from bs4 import BeautifulSoup
from docx import Document
try:
	from selenium import webdriver
	from selenium.webdriver.chrome.options import Options
	SELENIUM_AVAILABLE = True
except ImportError:
	import requests
	SELENIUM_AVAILABLE = False

def fetch_website_content(url):
	if SELENIUM_AVAILABLE:
		try:
			chrome_options = Options()
			# Do NOT add headless, so browser window is visible
			print("A browser window will open. Please complete any human verification (CAPTCHA) and then press Enter in this terminal to continue scraping.")
			driver = webdriver.Chrome(options=chrome_options)
			driver.get(url)
			input("Press Enter here after you have completed any verification in the browser...")
			html = driver.page_source
			driver.quit()
		except Exception as e:
			print(f"Error fetching {url} with Selenium: {e}")
			return None, None
	else:
		headers = {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
			"Accept-Language": "en-US,en;q=0.9",
			"Referer": "https://www.bing.com/",
			"Cookie": "SITE_TOTAL_ID=04c708ceb44158e9f21b863667218f94; _ga=GA1.1.2062403709.1760127945; _ga_NLJ1ZNJLD6=GS2.1.s1760129923$o2$g1$t1760129948$j35$l0$h0; cf_clearance=nhAnY2Qn7svgUH9dgTDqUzIQlXRLknTHB20auHBMqJk-1760129946-1.2.1.1-Lr0k4e4T7lOZE9MbrRy9TxIPRxmcGen7D1fClOQIJYl49GSOGqrmGfdFLpHWcL3Wmi4Js8XN7UM2pheGPcfww7BD.OLWS9WC.3rVbDq0R8VT.o3K3Vj6KmcxwtlhQNPy1Zlv83OBPQKqyh6xhhLRZP.CvTwuwDy3KeOEJZP2y05.liYKhXmOfH0MPyaKulEtHrl3HmZg1an8GaL1ZchZK1IYTKysGNcYfMllrIIwXxs"
		}
		try:
			response = requests.get(url, headers=headers)
			response.raise_for_status()
		except Exception as e:
			print(f"Error fetching {url}: {e}")
			return None, None
		html = response.text
	soup = BeautifulSoup(html, 'html.parser')
	# Remove script/style for text extraction
	for script_or_style in soup(['script', 'style']):
		script_or_style.decompose()
	text = soup.get_text(separator='\n')
	lines = [line.strip() for line in text.splitlines() if line.strip()]
	return '\n'.join(lines), html

def save_text_to_docx(text, filename):
	doc = Document()
	doc.add_paragraph(text)
	doc.save(filename)
	print(f"Text saved to {filename}")

def save_html_to_file(html, filename):
	with open(filename, 'w', encoding='utf-8') as f:
		f.write(html)
	print(f"HTML saved to {filename}")

if __name__ == "__main__":
	if len(sys.argv) < 2:
		print("Usage: python webscraper.py <URL> [output.docx|output.html]")
	else:
		url = sys.argv[1]
		output_file = sys.argv[2] if len(sys.argv) > 2 else "output.docx"
		text, html = fetch_website_content(url)
		if output_file.lower().endswith('.html'):
			if html:
				save_html_to_file(html, output_file)
		else:
			if text:
				save_text_to_docx(text, output_file)

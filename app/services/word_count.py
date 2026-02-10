from bs4 import BeautifulSoup


def count_words(html: str) -> int:
    """Strip HTML tags and count words."""
    text = BeautifulSoup(html, 'html.parser').get_text(separator=' ')
    return len(text.split())


def reading_time_minutes(word_count: int, wpm: int = 225) -> int:
    """Estimated reading time in minutes."""
    return max(1, round(word_count / wpm))

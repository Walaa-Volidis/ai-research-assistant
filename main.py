import json
import asyncio
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

MODEL = 'gemini-2.5-flash'

WEB_SEARCH = {'google_search': {}}


RESEARCH_PROMPT = """You are a thorough IT research assistant helping write academic papers and theses.

Search before you answer, and search repeatedly with different phrasings until you have
enough material. Never invent a title, author list, venue, year or URL, and never
reconstruct a citation from memory: if you did not see it in a search result, it does not
go in your notes.

Search academic sources, not the general web. A plain query returns mostly vendor blogs and
SEO listicles, which are not citable in a thesis, so scope your queries with site: filters —
arxiv.org, dl.acm.org, ieeexplore.ieee.org, link.springer.com, openreview.net, aclanthology.org,
scholar.google.com — and run several of them before concluding. Peer-reviewed papers,
conference proceedings and arXiv preprints only: no company blogs, tutorials, product pages
or "best models of the year" roundups, however well they match the topic.

For each paper record title, authors, year, venue and URL exactly as the search result gave
them, plus why it is relevant. Then cover the key formulas (with LaTeX) and recent trends.

If the requested time frame yields fewer than 5 papers, report the ones you actually found
and say so plainly. A short honest answer is correct; a padded fabricated one is not."""

FORMAT_PROMPT = """Convert the research notes below into the Report schema.

Use only what the notes contain. Do not add papers, formulas, trends or URLs that do not
appear in them, and do not fill gaps from your own knowledge — leave optional fields null
instead. Copy titles, authors, years and URLs across verbatim."""

class Paper(BaseModel):
    title: str
    authors: list[str]
    year: int
    venue: str | None = None
    url: str | None = None
    relevance: str = Field(description='Why this paper is relevant to the topic or research questions.')

class Formula(BaseModel):
    name: str
    latex: str = Field(description="LaTeX source for the formula, no surrounding delimiters.")
    description: str
    reference: str | None = Field(default=None, description="Paper, textbook or source where the formula comes from.")

class Trend(BaseModel):
    title: str
    description: str
    references: list[str] = Field(default_factory=list, description="Titles or URLs of papers backing this trend.")

class Report(BaseModel):
    topic: str
    research_questions: list[str]
    time_frame: str | None = None
    papers: list[Paper] = Field(description="5 to 10 most relevant papers")
    formulas: list[Formula] = Field(description="Key formulas and equations")
    trends: list[Trend] = Field(description="Key trends and future directions")
    
def _grounding_urls(message):
    """Pull the sources Gemini actually retrieved out of the grounding metadata.

    These are the real evidence for the report, so they are passed to the formatting
    step to keep it from inventing plausible-looking URLs of its own.
    """
    chunks = (message.response_metadata.get('grounding_metadata') or {}).get('grounding_chunks') or []
    seen = []
    for chunk in chunks:
        web = chunk.get('web') if isinstance(chunk, dict) else None
        if web and web.get('uri'):
            entry = f"- {web.get('title') or 'untitled'}: {web['uri']}"
            if entry not in seen:
                seen.append(entry)
    return seen

async def generate_report(topic, questions, time_frame) -> Report:
    """Research the topic and return a populated Report. Used by both the CLI and the web UI."""
    task = f"""Topic: {topic}
Research questions: {questions}
Time frame: {time_frame or 'no specific focus'}

Gather 5-10 highly relevant papers.
Then identify the most important mathematical formulas for this subject and recent trends."""

    researcher = ChatGoogleGenerativeAI(model=MODEL).bind_tools([WEB_SEARCH])
    notes = await researcher.ainvoke([
        {'role': 'system', 'content': RESEARCH_PROMPT},
        {'role': 'user', 'content': task},
    ])

    sources = _grounding_urls(notes)
    findings = notes.text
    if sources:
        findings += '\n\nSources actually retrieved:\n' + '\n'.join(sources)

    formatter = ChatGoogleGenerativeAI(model=MODEL).with_structured_output(Report)
    return await formatter.ainvoke([
        {'role': 'system', 'content': FORMAT_PROMPT},
        {'role': 'user', 'content': f'{task}\n\n--- RESEARCH NOTES ---\n{findings}'},
    ])

async def main():
    topic = input('what is the topic for the paper/thesis?').strip()
    questions = input('what are the key research questions?').strip()
    time_frame = input('what time frame should the papers be from?').strip()
    report = await generate_report(topic, questions, time_frame)
    print(json.dumps(report.model_dump(), indent=2))

if __name__ == '__main__':
    asyncio.run(main())

    
import asyncio
from flask import Flask, jsonify, render_template, request
from main import generate_report
from langchain_mcp_adapters.client import LangChainClient
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain.agents import create_agent
from langchain.agents.structured_output import tool_strategy

app = Flask(__name__)


@app.get('/')
def index():
    return render_template('index.html')


@app.post('/api/report')
def api_report():
    data = request.get_json(silent=True) or {}
    topic = (data.get('topic') or '').strip()
    questions = (data.get('questions') or '').strip()
    time_frame = (data.get('time_frame') or '').strip()

    if not topic:
        return jsonify(error='A topic is required.'), 400

    try:
        # generate_report is async and each Flask request gets its own thread,
        # so a fresh event loop per request is safe here.
        report = asyncio.run(generate_report(topic, questions, time_frame))
    except Exception as exc:
        return jsonify(error=f'{type(exc).__name__}: {exc}'), 502

    return jsonify(report.model_dump())


if __name__ == '__main__':
    app.run(debug=True, port=5000)

import streamlit as st
import requests
import folium
from streamlit_folium import st_folium
import time

API_KEY = "tyy8znhl0u5kbbb2vuvdhfetmsil041u"

st.set_page_config(layout="wide")
st.title("🌍 Infinite Radar ✈️")

# Store trails
if "trails" not in st.session_state:
    st.session_state.trails = {}

def get_data():
    try:
        sessions = requests.get(
            f"https://api.infiniteflight.com/public/v2/sessions?apikey={API_KEY}"
        ).json()
        session_id = sessions["result"][0]["id"]

        flights = requests.get(
            f"https://api.infiniteflight.com/public/v2/sessions/{session_id}/flights?apikey={API_KEY}"
        ).json()

        atc = requests.get(
            f"https://api.infiniteflight.com/public/v2/sessions/{session_id}/atc?apikey={API_KEY}"
        ).json()

        return flights["result"], atc["result"]
    except:
        return [], []

search = st.text_input("🔍 Search Callsign")

placeholder = st.empty()

while True:
    with placeholder.container():
        flights, atc_units = get_data()

        m = folium.Map(location=[20, 0], zoom_start=2, tiles="CartoDB dark_matter")

        # Planes
        for f in flights:
            if not f.get("latitude") or not f.get("longitude"):
                continue

            cs = f["callsign"]

            if search and search.lower() not in cs.lower():
                continue

            lat, lon = f["latitude"], f["longitude"]

            # Trails
            if cs not in st.session_state.trails:
                st.session_state.trails[cs] = []

            st.session_state.trails[cs].append((lat, lon))

            if len(st.session_state.trails[cs]) > 20:
                st.session_state.trails[cs].pop(0)

            folium.PolyLine(
                st.session_state.trails[cs],
                color="cyan",
                weight=2
            ).add_to(m)

            heading = f.get("heading", 0)

            icon_html = f"""
            <img src="https://raw.githubusercontent.com/vandehoekencitizens/infinite-radar/main/f5c530aa-d922-4920-9313-63a11c7f2921.png"
                 style="width:20px; transform: rotate({heading}deg);">
            """

            icon = folium.DivIcon(html=icon_html)

            popup = f"""
            <b>{cs}</b><br>
            Alt: {f['altitude']} ft<br>
            Speed: {f['speed']} kts<br>
            Heading: {heading}°
            """

            folium.Marker(
                location=[lat, lon],
                icon=icon,
                popup=popup
            ).add_to(m)

        # ATC overlay
        for a in atc_units:
            if a.get("latitude") and a.get("longitude"):
                folium.CircleMarker(
                    location=[a["latitude"], a["longitude"]],
                    radius=6,
                    color="yellow",
                    fill=True,
                    fill_opacity=0.7,
                    popup=f"ATC: {a['callsign']}"
                ).add_to(m)

        st_folium(m, width=1400, height=700)

    time.sleep(5)

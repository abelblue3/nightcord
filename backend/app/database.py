from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.config import settings

# pre_ping: after Postgres restarts or sleeps, pooled connections are dead;
# test each one before use instead of failing the request that gets it.
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_session_factory() -> sessionmaker:
    """For the chat socket, which stays open for hours: it opens a short
    session per database step instead of holding one (and its pooled
    connection) for its whole life.
    """
    return SessionLocal
